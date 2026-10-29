# Moon map: provenance and credit

`lroc_color_2k.jpg` is a **vendored, unmodified copy** of the colour map from NASA's
[CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (NASA Scientific Visualization Studio), the Moon's
surface in Night Sky's Globe view. The renderer (`js/render-nightsky-globe.js`) recolours it at
load time to match the globe's muted palette; the file on disk is left as it was downloaded.
`lroc_color_256.jpg` is a thumbnail of it for the Moon drawn as it looks in Sky Map and
Planetarium (`js/render-moon.js`), where the disc is at most ~38 px across.

## File

| File | Content | Fetched from |
|---|---|---|
| `lroc_color_2k.jpg` | Colour map, equirectangular, 2048 × 1024, centred on 0° selenographic longitude (east to the right), 2025 version | [svs.gsfc.nasa.gov/…/a004720/lroc_color_2k.jpg](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg) |
| `lroc_color_256.jpg` | The same map scaled down to 256 × 128 (macOS `sips -z 128 256`, JPEG quality 85, 13.7 KB) | derived from `lroc_color_2k.jpg` |

SHA-256: `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170` (downloaded 27 Oct 2026);
thumbnail `8509715410aa4019ea4324e2e36bc3f980c0f8739e8f87d63ee340fc7994677e` (made 28 Oct 2026).

## Credit

**NASA's Scientific Visualization Studio** (visualizer Ernie Wright, scientist Noah Petro). The
map is assembled from Lunar Reconnaissance Orbiter Camera (LROC) Wide Angle Camera data
(NASA / GSFC / Arizona State University). NASA describes it as tuned for appearance rather than
science; scientific work should use the LROC WAC Hapke mosaic.

## Use

NASA imagery is generally not subject to copyright in the United States; NASA asks for
acknowledgement as the source and that its material not be used to imply endorsement (see
[NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)).
The SVS page itself states no separate license.
