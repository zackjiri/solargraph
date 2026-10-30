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

🌌 **Sky Dome** - the same sun paths in true compass projections: a Sky Map, an azimuth-elevation planetarium chart (its sky coloured by the Sun's height as in Night Sky, from day through the twilight glow and the Belt of Venus to night), an orbiting 3D view, and an experimental warp of the calibrated photo onto the dome itself. While the photo is shown on the dome, **Show flat** opens it straightened into a cylindrical panorama with the current calibration: azimuth across, the horizon level and vertical edges upright.

🌦 **CHMI weather data** - measured sunshine duration or air temperature from the nearest Czech Hydrometeorological Institute station, in 10-minute resolution. It colours the sun path directly on the photo, or covers the whole exposure period at once, and appears in the Sun Graph too - so the modelled clear-sky day can be held against what the weather actually did.

🌑 **Eclipse mode** - a solar eclipse simulator for a handful of recent and upcoming events, picked by the author, computed from NASA/eclipsewise **Besselian elements** with the standard reduction for any observer (Meeus ch. 54): WGS84 flattening, ΔT applied to Earth's rotation and topocentric parallax for the Moon's apparent size. Greatest Eclipse points agree with NASA to within ~100 m, and five of the events are checked against the author's own photographs; magnitude for total and annular events still differs from published figures by ~0.02–0.03. Like the published figures, the mode is geometric, without refraction, so near the horizon the Sun sits up to ~0.5° lower than it is seen. The globe button maps the event on the Earth: the path of totality or annularity with its width and central duration, lines of greatest magnitude 0.2 to 0.8 over zones that darken toward the path, and the edge of visibility, all while the Sun is up; a click on the globe moves the Location there. The map is computed once from the same model by `tools/eclipse-map.js` (`osascript -l JavaScript` on macOS, nothing to install) and matches the simulator's contact times and magnitudes.

🌠 **Night Sky mode** - the real sky for any place, date and time: 5,044 stars down to magnitude 6, the 88 IAU constellations, the Milky Way and 132 deep sky objects, as an all-sky Planetarium, a flat or 3D Sky Map, the Earth seen from space in Orbit or a Sun Graph of the whole year, all on one timeline that keeps animating across them. Any object can be found by name or catalogue number. It needs the actual calendar year, because local sidereal time at a fixed date and clock time drifts by about 6 hours from one year to the next; star positions follow from right ascension and declination through Greenwich sidereal time (Meeus ch. 12). An info panel gives rise and set times and azimuths of the Sun and Moon, their distances from the observer, the day length and the Moon's phase and age.

- **Moon** - from the full lunar series in Meeus ch. 47, up to 5.1° off the ecliptic like the real one and corrected for topocentric parallax (up to ~1° near the horizon). The Sun and the Moon reach their true angular size when zoomed in; the phase faces the Sun and carries earthshine. During a lunar eclipse Earth's shadow crosses the disc, sized by Danjon's rule as in NASA's predictions: shadow radii and magnitudes agree with NASA to the fourth decimal, contact times to within a minute.

- **Milky Way** - five brightness levels of the Milky Way Outline Catalog, filled once into a soft RA/Dec brightness map, with the Great Rift in Cygnus and the Coal Sack as dark lanes. Sky Map, Planetarium and the sky behind the Earth in Orbit sample it pixel by pixel, so the horizon and the edge of the view cut the band without any clipping of its outlines.

- **Limiting magnitude and star size** - in the Planetarium and the flat Sky Map, a Mag ≤ slider hides stars, planets, deep sky objects and the Milky Way's fainter levels below the limit (6+ shows everything), and three star sizes bring out the faint stars while keeping the bright ones larger, so the constellations stay readable. Zooming in enlarges the stars too.

- **Atmosphere** - in the Planetarium and the flat Sky Map, the sky as the eye sees it: no stars by day, the brightest from civil twilight, all after astronomical twilight, fewer near the Moon (Krisciunas & Schaefer) and the horizon. Moonlight grows gradually as the Moon climbs, dimmed near the horizon by the full air mass (Kasten & Young), and tints the sky round the Moon in its own colour, silvery high up and warm low down. On the dark theme the sky takes its colour from its brightness, the Moon shows only its sunlit part, and a solar eclipse darkens the sky as the Moon's shadow passes: in the partial phases the Moon is a bite out of the Sun with the sky showing through it, in totality a dark disc in the corona.

- **Deep sky** - the 110 Messier objects plus 22 showpieces Messier never listed: the Magellanic Clouds, ω Centauri, 47 Tucanae and η Carinae in the south, the Hyades, the Double Cluster and the Coathanger in the north. Atlas-style symbols per type (galaxy, open or globular cluster, nebula, planetary nebula) at true angular size, so a zoomed Planetarium shows M31 as large as it really is.

- **Planets** - Mercury to Saturn from JPL's approximate Keplerian elements (Standish), corrected for light time; within a few arcseconds of JPL Horizons for Mercury and Venus, under 1′ for Mars and Jupiter, about 5′ for Saturn. Dot size follows brightness (Schlyter, including Saturn's rings), and Mercury and Venus show as silhouettes when they transit the Sun. Uranus (~5.7 mag, at the edge of naked-eye visibility) and Neptune (~7.8 mag) come from the same elements and join them when `Only naked eye` is switched off.

- **Sun Graph** - the year in standard time at the chosen time zone, with the Moon's hours above the horizon shaded by its illumination and the stretches of moonless astronomical night. `Galactic center` shades the night hours when the core of the Milky Way stands at least 0°, 5° and 10° high, moonlight included, since the core shows through it; the length view counts those hours per night. A lunar calendar marks the phases: full moons carry Earth's shadow, and a new moon that eclipses the Sun from the chosen place shows the eclipse on the solar disc. `Thin crescent` rates, by Odeh's criterion, the chance of catching the young or old Moon in the twilight next to each new moon, and rings the youngest crescent the eye can catch in gold, silver or bronze for under 24, 36 or 48 hours.

- **Orbit** - the Earth from space at the chosen moment, with day, twilight and night for every pixel, seasonal snow and sea ice, the Moon at its true distance and the stars and planets behind. Both kinds of eclipse come from the real geometry: the Moon's shadow on the Earth, the Earth's copper shadow on the Moon. `EARTH | MOON` orbits either body (the Moon in NASA's LRO colour map, with libration), `EQU | ECL | HOR` levels the view on the equator, the ecliptic or the surface, and an orientation rose shows the sky dome, the ecliptic, the celestial equator and the direction of the Sun; hover over it for a legend.

- **Search** - the magnifier next to the crosshair finds the Sun, the Moon, the planets, 154 named stars, the 88 constellations and the deep sky objects by name or catalogue number (`M31`, `NGC 224`, `Vega`, Czech constellation names too). The Planetarium and Orbit turn to the object, the Sky Map marks it, and the info panel says where it stands, when it rises, culminates and sets, and whether the eye can see it now. An object that never rises at the place is framed in red.

- **Image export** - the round button in the corner of the Sky Map and the Sun Graph saves the view as PNG, JPEG or WebP in a standard 16:9 size from HD to 8K UHD. The picture is laid out as on a 1080p screen whatever its size, so a larger export brings sharper lines and stars rather than smaller labels.

- **Coordinate grids** - the Az/Alt and equatorial grids of the Planetarium follow the zoom: 30° in the all-sky view, then 15°, 10°, 5° and finer down to arcminutes, so a zoomed view always has a few lines with their labels.

- **Catalog** - the author's astrophotographs of landscapes, Solar System objects and deep-sky targets. A photo restores the date, time and place it was taken and marks its field on the sky through an exact gnomonic projection, so even a 100° wide-angle frame lands where it belongs.

📍 **Set here** - fills in Location from the device's position (the browser asks for permission). If that is refused or unavailable, it falls back to an approximate, city-level position looked up from the IP address via ipapi.co or geojs.io, which then receive the visitor's IP address. Only on click, never automatically.

🕓 **Time zone with the Location** - Set here and a click on the globe also set the time zone of the new place, looked up offline from a grid of the world's time zones bundled with the app. The offset is the one in force at the moment on screen: the eclipse's in Eclipse, the calendar's in Night Sky, standard time elsewhere. At sea, nautical time from the longitude.

🌍 **Select** - picks Location on a globe of the Earth that opens over the canvas, built from the same Natural Earth data as the Orbit view, so no map service is involved. Drag to turn it, scroll or pinch to zoom; the point under the pin shows in the Location fields as you move, and a click sets it. The round button in its corner lays the world's time zones over the Earth, coloured by their offset from UTC at the moment on screen, with the zone and offset of the point under the pin in the window's header.

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
4. **Eclipse** - pick an event in the Catalog, then scrub the time slider or press play; click the speed label to change the rate. `Load gallery` marks the moments of real photographs, `Find the greatest point` moves you to where the eclipse was deepest. The globe button in the corner opens the eclipse map, where a click picks a new place.
5. **Night Sky** - opens in the Planetarium at the current moment; drag to look around, switch to `Sky Map`, `Orbit` or `Sun Graph` with the wheel picker. The crosshair button locks the view on an RA/Dec point, the magnifier finds an object (↑ ↓, Enter, Escape work in the list). In the Sky Map the round arrow turns the map 90°; in Orbit, drag to orbit and use the wheel for distance or field of view; in the Sun Graph a click sets the date and time. Under Display, `Mag ≤` sets the faintest objects shown, `Atmosphere` turns on the real sky, and `Only naked eye` off adds Uranus and Neptune. The `Catalog` above lists the astrophotographs.

---

## 🛠 Troubleshooting

- **Blank canvas** - make sure a Generation and Image are selected in Gallery, or that a scan is loaded in Analyzer (`↩ Load new image`).
- **Calibration looks wrong** - hit `Reset calibration`, then work in order: Yaw, Pitch and Roll first, Horizon and Radius last.
- **`CHMI data` is greyed out** - measured data exists only for images with a matching station extract; not every solargraph has one.
- **`Split screen` is disabled** - it compares the Enhanced scan with a real scene photo, and not every image has one.
- **A section disappeared** - click the ▼ / ▶ triangle by its heading; sections collapse their contents, never themselves.
- **Date, location or time won't change in Night Sky** - they are locked while a Catalog photo is shown, so the frame stays true to it. Switch to another view or go back to the Catalog to unlock them.
- **No stars in Night Sky** - with `Atmosphere` on, the sky shows only what the eye would see: nothing by day, few stars in twilight or under a bright Moon. Move the time into the night or switch `Atmosphere` off; also check `Mag ≤` is at `6+`.
- **Search picked an object but the view did not turn** - it is below the horizon; its rise time is in the info panel. An object framed in red never rises at the chosen place.
- **Uranus or Neptune missing** - switch `Only naked eye` off under `Planets`. With `Atmosphere` on, Neptune stays hidden: it is too faint for the eye.
- **On a phone** - the layout stacks below ~640 px, but fine calibration is much easier on a tablet or desktop.
- **Changes don't show up** - this is static HTML and JavaScript with no build step; a hard refresh clears most stale state.

---

## 📄 License

Solargraphy Viewer is released under a non-commercial, attribution-required license.

You're free to use, copy, modify and share it, as long as it's not for commercial advantage or monetary gain, and you credit Jiri Zach as the original author in any copy or derivative you distribute.

Modified or redistributed versions stay under these same terms - no relicensing, no dropping the non-commercial restriction. Commercial use requires separate written permission from [the author](mailto:zack.jiri@gmail.com).

The software is provided as-is, with no warranty of any kind. Breaking these terms ends your rights under the license automatically.

All photographs published with the app - the solargraphs in the Gallery, the eclipse images in the Eclipse photo galleries and the astrophotographs and videos in the Night Sky Catalog - are the author's own work and are **not** covered by the license above. They may not be redistributed, republished, reused or modified, in whole or in part and in any medium, without prior written permission from the author.

Sunshine duration and air temperature measurements shown in the app come from the **open data** of the Czech Hydrometeorological Institute, licensed separately under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.cs).

Star, constellation (lines and names), Milky Way and deep sky data in the Night Sky mode are vendored from [D3-Celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn, licensed separately under **BSD-3-Clause** - see [`data/celestial/NOTICE.md`](data/celestial/NOTICE.md) for the full license text and original catalog sources. The table of star names used by the search (`data/celestial/starnames.json`) was compiled for this project from the IAU's list of star names.

Land outlines in Orbit (`data/earth/land-110m.json`) come from the [world-atlas](https://github.com/topojson/world-atlas) package by Mike Bostock, licensed under **ISC**, with geometry from [Natural Earth](https://www.naturalearthdata.com/), which is in the **public domain**; the lakes (`data/earth/ne_110m_lakes.geojson`) come from Natural Earth directly, also public domain - see [`data/earth/NOTICE.md`](data/earth/NOTICE.md).

The Moon's surface map (`data/moon/lroc_color_2k.jpg`) is from the [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) by **NASA's Scientific Visualization Studio**, built from Lunar Reconnaissance Orbiter Camera data (NASA / GSFC / Arizona State University). NASA imagery is generally not subject to copyright in the United States; it is credited here as NASA asks, and its use implies no endorsement by NASA - see [`data/moon/NOTICE.md`](data/moon/NOTICE.md).

The time zone grid (`data/timezones/tz-grid.js`) is generated by `tools/tz-grid.js` from the boundaries of [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) (release 2026e), which are © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors and available under the **Open Database License (ODbL) 1.0**; the grid, a database derived from them, is under the same license. Zone names and rules come from the IANA tz database, in the **public domain** - see [`data/timezones/NOTICE.md`](data/timezones/NOTICE.md).

---

© 2026 [Jiri Zach](mailto:zack.jiri@gmail.com)
