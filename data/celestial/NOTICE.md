# Celestial data - provenance & license

The files in this folder are **vendored copies** of data from the
[D3-Celestial](https://github.com/ofrohn/d3-celestial) project by Olaf Frohn, except
`starnames.json` (see below) and `stars.6-8.json`, derived from D3-Celestial's `stars.8.json`
(see Modifications), used here only as a
data source for the Night Sky mode (star positions, constellation lines, the Milky Way and deep sky objects). No code from that project
is used - only the GeoJSON data files below, read by this project's own renderer
(`js/render-nightsky.js`, `js/render-milkyway.js`, `js/render-deepsky.js`, `js/render-search.js`).

## Files

| File | Content | Fetched from |
|---|---|---|
| `stars.6.json` | Stars down to 6th magnitude (naked-eye limit), 5,044 stars | [data/stars.6.json](https://github.com/ofrohn/d3-celestial/blob/master/data/stars.6.json) |
| `stars.6-8.json` | The stars fainter than `stars.6.json` down to magnitude 8.0, 36,367 stars, for the equipment's field of view | derived from [data/stars.8.json](https://github.com/ofrohn/d3-celestial/blob/master/data/stars.8.json), fetched 2026-11-05 (see Modifications) |
| `constellations.lines.json` | IAU constellation stick-figure lines | [data/constellations.lines.json](https://github.com/ofrohn/d3-celestial/blob/master/data/constellations.lines.json) |
| `constellations.json` | Constellation names (Latin, English, Czech and other languages) and label positions, read by the Planetarium search (`js/render-search.js`) | [data/constellations.json](https://github.com/ofrohn/d3-celestial/blob/master/data/constellations.json), fetched 2026-10-29 |
| `mw.json` | The Milky Way as five nested brightness outlines (`ol1` faintest to `ol5` brightest) | [data/mw.json](https://github.com/ofrohn/d3-celestial/blob/master/data/mw.json) |
| `messier.json` | The 110 Messier objects | [data/messier.json](https://github.com/ofrohn/d3-celestial/blob/master/data/messier.json) |
| `dsos.bright.json` | Bright showpiece deep sky objects of the whole sky, selected by Olaf Frohn | [data/dsos.bright.json](https://github.com/ofrohn/d3-celestial/blob/master/data/dsos.bright.json) |
| `dsonames.json` | Common names of deep sky objects | [data/dsonames.json](https://github.com/ofrohn/d3-celestial/blob/master/data/dsonames.json) |
| `starnames.json` | Proper names of 154 bright stars by HIP number, for the Planetarium search (`js/render-search.js`) | **Not from D3-Celestial**: written for this project (see below) |
| `LICENSE` | D3-Celestial's own BSD-3-Clause license text | [LICENSE](https://github.com/ofrohn/d3-celestial/blob/master/LICENSE) |

Coordinates are `[RA, Dec]` in degrees, J2000 epoch, RA pre-converted from 0–24h to −180..180°
(D3-Celestial's own GeoJSON convention - see its [data format readme](https://github.com/ofrohn/d3-celestial/blob/master/data/readme.md)).

## License

D3-Celestial itself is released under the **BSD-3-Clause license** (full text in `LICENSE`,
this folder) - copyright Olaf Frohn. Redistribution requires only keeping that copyright notice
and disclaimer, which this folder does.

## Original data sources (per D3-Celestial's own readme)

D3-Celestial converted these from public astronomical catalogs, not its own original research:

- **Stars** (`stars.6.json`, `stars.6-8.json`): XHIP - Extended Hipparcos Compilation, Anderson E., Francis C.
  (2012), [VizieR V/137D](http://cdsarc.u-strasbg.fr/viz-bin/Cat?V/137D)
- **Constellation lines** (`constellations.lines.json`) and **names** (`constellations.json`): [IAU Constellation page](https://www.iau.org/public/themes/constellations/),
  name positions and some line modifications by Olaf Frohn
- **Milky Way** (`mw.json`): [Milky Way Outline Catalog](http://www.skymap.com/milkyway_cat.htm),
  Jose R. Vieira
- **Messier objects** (`messier.json`): [Messier Objects with Data](http://messier.seds.org/data.html),
  H. Frommert / SEDS
- **Bright deep sky objects** (`dsos.bright.json`): "some of the brightest showpiece DSOs" of
  Olaf Frohn's own choosing (D3-Celestial readme, no further source given)
- **Deep sky object names** (`dsonames.json`): D3-Celestial, no separate source given

## `starnames.json` (this project's own)

Written for this project, not fetched: the proper names of bright stars as the IAU Working Group on
Star Names lists them, each keyed by its Hipparcos (HIP) number, in the format of D3-Celestial's own
`data/starnames.json` (`{"HIP": {"name": ...}}`), so that file could replace this one without any
change to the code. Checked against `stars.6.json`: every HIP number is there and its magnitude is
within 0.5 of the star's usual value (Rasalgethi, a variable, 0.7). The positions are not checked
separately. Mira is left out: as a variable it is missing from `stars.6.json`.

## Modifications

The data of the D3-Celestial JSON files is unchanged. `stars.6.json` is stored re-indented (one
key per line); minified it is byte-identical to the upstream file (656,721 bytes). The others are
the upstream files as fetched.

`stars.6-8.json` is made by this project's `tools/stars-deep.py` from D3-Celestial's
`data/stars.8.json` (41,411 stars, magnitude −1.44 to 8.00; its readme says 8.5, the file ends at
8.0). The 5,044 stars of `stars.6.json` are in it with the same values; the tool checks that and
keeps only the other 36,367 (magnitude 6.01 to 8.00), so the two files together are the whole
`stars.8.json` without overlap. Layout changed, values not: `{"fields": ["id", "mag", "bv", "ra",
"dec"], "stars": [[HIP, mag, B-V, RA, Dec], ...]}`, one star per line, sorted by Dec; B-V turned
from a string into a number (empty, 50 stars, into `null`). RA and Dec as upstream (degrees, J2000,
RA −180..180).

If any of these files is ever locally modified (e.g. filtered, trimmed, or corrected), that fact **must**
be recorded both here and as a note in this same section - describe what changed and why, so the
files never silently diverge from a state this notice still claims is "byte-identical to upstream".
