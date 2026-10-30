# Earth data: provenance and license

The files in this folder are **vendored, unmodified copies**: the land from the
[world-atlas](https://github.com/topojson/world-atlas) package by Mike Bostock (version 2.0.2,
fetched from jsDelivr) and the lakes straight from [Natural Earth](https://www.naturalearthdata.com/),
used here only as a data source for Night Sky's Globe view and the Location globe (SELECT). No code from
that package is used; the TopoJSON is decoded by this project's own renderer
(`js/render-nightsky-globe.js`).

## Files

| File | Content | Fetched from |
|---|---|---|
| `land-110m.json` | Land polygons, TopoJSON, quantized, 1:110m scale | [world-atlas@2.0.2/land-110m.json](https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json) |
| `ne_110m_lakes.geojson` | The 24 largest lakes, GeoJSON, 1:110m scale (Natural Earth 1:110m Physical Vectors, Lakes) | [nvkelso/natural-earth-vector, geojson/ne_110m_lakes.geojson](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_lakes.geojson) |
| `LICENSE` | world-atlas's own ISC license text | [world-atlas@2.0.2/LICENSE](https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/LICENSE) |

Coordinates are `[longitude, latitude]` in degrees, on the sphere: some rings cross the 180°
meridian or go round a pole (Antarctica). The renderer unwraps them before filling its flat land
map, so their fill doesn't come out inverted.

## License

world-atlas is released under the **ISC license** (see `LICENSE`). Its geometry is derived from
[Natural Earth](https://www.naturalearthdata.com/), which is in the **public domain**, as is the
lake file taken from Natural Earth directly.
