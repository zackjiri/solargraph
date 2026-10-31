# Time zone data: provenance and license

`tz-grid.js` gives the IANA time zone of any point on the Earth. SET HERE and a click on the
globe (SELECT, the Eclipse map) use it to set the Time zone with the Location
(`js/tz-lookup.js`). It is **generated**, not vendored: `tools/tz-grid.js` computes it from the
time zone boundaries of [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder)
by Evan Siroky, which builds them from [OpenStreetMap](https://www.openstreetmap.org/) data.

## Files

| File | Content | Made from |
|---|---|---|
| `tz-grid.js` | A 1° grid of the Earth, split 2 x 2 down to 1/16° (about 7 km) where a boundary between zones passes; per cell the IANA zone, or none at sea | timezone-boundary-builder release **2026e**, `timezones-1970.geojson.zip` (the "1970" variant without oceans), [releases](https://github.com/evansiroky/timezone-boundary-builder/releases) |

The "1970" variant merges zones that have kept the same rules since 1970, under one of their
names: Thailand, for one, comes out as `Asia/Jakarta`, the Netherlands as `Europe/Brussels`. The
offsets are right; the name may be another country's city.

Where two zones' polygons overlap (disputed areas), the grid takes the zone a phone's clock shows
there, the official time of the state that runs the area; the pairs are listed in
`OVERLAP_PREFER` in `tools/tz-grid.js`, which also reports any overlap the list does not name.

The offsets themselves come from the browser's own copy of the IANA tz database (`Intl`), not
from this folder.

## Regenerating

From the unpacked `timezones-1970.geojson.zip` of a release (a `combined-1970.json` of ~150 MB):

```
osascript -l JavaScript tools/tz-grid.js combined-1970.json data/timezones/tz-grid.js --release=<tag>
```

About 4 minutes and 1.3 GB of memory on the whole Earth. Then update the release in the table
above and in the README.

## License

- The time zone boundaries are © **OpenStreetMap contributors**, made available under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  `tz-grid.js` is a database derived from them and is made available under the same license.
  The app names the source in the info line wherever it sets a Time zone from these data, and
  on the globe, while its time zones show, as "Time zones: © OpenStreetMap contributors, ODbL ·
  timezone-boundary-builder <release>", linking to the OpenStreetMap copyright page and the
  release.
- timezone-boundary-builder's code is under the MIT license; none of it is used here, only its
  released data.
- The zone names and rules are those of the [IANA tz database](https://www.iana.org/time-zones),
  which is in the **public domain**.
