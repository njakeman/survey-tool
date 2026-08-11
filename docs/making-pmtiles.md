# Making vector PMTiles from your own GIS data

Written for Windows, because that is where this repo is developed and because most advice on the
subject quietly assumes a Unix shell.

## Read this first: you probably want a feature layer

This app has two ways to put your data on the map, and they are not interchangeable.

|           | Feature layer                              | Vector PMTiles                             |
| --------- | ------------------------------------------ | ------------------------------------------ |
| Format    | one `.geojson` in `public/feature-layers/` | one `.pmtiles` in `public/basemaps/`       |
| Good for  | up to a few thousand features              | tens of thousands upward                   |
| Tooling   | none — drop the file in                    | tippecanoe or QGIS, plus the `pmtiles` CLI |
| Drawn     | over whichever basemap is active           | **as** the basemap, instead of one         |
| Tappable  | yes — attributes, and "Record here"        | no                                         |
| Styled by | `<id>.style.json` beside the data          | not supported (see the limitation below)   |

Parcels, designations, monitoring points, a hedgerow network — anything you would open in QGIS and
scroll through — is a feature layer. See the README's _Feature layers_ section; there is nothing on
this page you need.

Reach for vector tiles when a dataset is genuinely too large to hold in memory and draw as one
GeoJSON: full county coverage, a national dataset, address points. **Before you do, read the
limitation at the bottom of this page** — a vector archive you build yourself will not render as a
basemap in this app today, and knowing that now will save you an afternoon.

## Step 1 — get to GeoJSON in EPSG:4326

Whatever you have — Shapefile, GeoPackage, a PostGIS export — convert it with `ogr2ogr`, which
ships with [GDAL](https://gdal.org/) and comes bundled with QGIS (use the _OSGeo4W Shell_ that
QGIS installs, where `ogr2ogr` is already on the PATH):

```sh
ogr2ogr -f GeoJSON -t_srs EPSG:4326 parcels.geojson parcels.gpkg
```

**`-t_srs EPSG:4326` is not optional.** Web Mercator tiling is defined in longitude/latitude, and
UK data is very often British National Grid (EPSG:27700), whose coordinates are metres — eastings
around 400000, northings around 100000. Nothing complains: it is valid JSON and valid GeoJSON, and
your layer silently lands in the Atlantic off west Africa. The feature-layer manifest generator in
this repo rejects out-of-range coordinates for exactly this reason and names the fix; tippecanoe
will not.

Check before going further:

```sh
ogrinfo -so -al parcels.geojson | findstr Extent
```

Extents should look like `(-2.2, 51.4) - (-1.6, 51.8)`, not six-digit numbers.

## Step 2a — QGIS, no extra install

QGIS can write vector tiles itself, which makes this the only route with no Docker, no WSL and no
compiler. `QgsVectorTileWriter` has been in QGIS since 3.14, so anything current will do.

1. Load your layers and style them how you like.
2. **Processing Toolbox → Vector Tiles → Write Vector Tiles (MBTiles)**
   (`native:writevectortiles`).
3. Set the zoom range and the output `.mbtiles` path. Keep the maximum zoom as low as you can live
   with — each level roughly quadruples the tile count.

Then convert to PMTiles with the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles/releases),
which ships a Windows `.exe` — download it, put it somewhere on your PATH:

```sh
pmtiles convert parcels.mbtiles parcels.pmtiles
pmtiles cluster parcels.pmtiles
```

`pmtiles cluster` reorders the archive so tiles that are near each other are near each other in the
file. Skip it and every map pan costs more reads than it needs to; it matters most over a slow
connection, which is the situation this app exists for.

The layer name inside the tiles is the QGIS layer name. Note it down — step 3 needs it.

## Step 2b — tippecanoe, when you need control

[felt/tippecanoe](https://github.com/felt/tippecanoe) is the maintained fork (Mapbox's original is
archived), and since 2.17 it writes `.pmtiles` directly, so there is no conversion step. It gives
you real control over what survives at low zoom, which QGIS does not.

There is no Windows build. Use Docker Desktop:

```sh
docker run --rm -v "%cd%:/data" ghcr.io/felt/tippecanoe:latest ^
  tippecanoe -o /data/parcels.pmtiles ^
  -l parcels ^
  -zg --drop-densest-as-needed --extend-zooms-if-still-dropping ^
  /data/parcels.geojson
```

(In PowerShell use `${PWD}` instead of `%cd%` and a backtick instead of `^` for line
continuation; or run it as one line.)

The flags that matter:

- **`-l parcels`** — the layer name inside the tiles. Get this wrong and everything else still
  works: the archive builds, the header is fine, the tiles are full of data, and the map renders
  nothing, because the style is looking for a layer name that is not there. It is the single most
  common failure and it produces no error anywhere. Without `-l`, tippecanoe names the layer after
  the input filename, which is fine as long as you know that is what happened.
- **`-zg`** — choose the maximum zoom automatically from feature density. A sane default.
- **`--drop-densest-as-needed`** — when a tile is over the size limit, drop the most crowded
  features rather than failing. Without it, dense areas produce errors or oversized tiles.
- **`--extend-zooms-if-still-dropping`** — keep adding zoom levels until features stop being
  dropped. Worth it when detail at high zoom is the point.

Then `pmtiles cluster` as above.

## Step 3 — put it in the app

```sh
copy parcels.pmtiles public\basemaps\
npm run basemaps:manifest
```

The manifest generator reads each archive's real header, so bounds, zoom range and size cannot
drift from the file. The filename becomes the region name (`north-wiltshire.pmtiles` → "North
Wiltshire"). Commit both the archive and the regenerated manifest.

Constraints, all covered in the README's _Offline basemap_ section but worth repeating:

- **100 MB hard ceiling per file** — GitHub's limit, and Git LFS is not a way around it (Pages
  serves the pointer file, not the bytes).
- Every archive is permanent repo weight, checked out on every CI run.
- An archive the generator cannot read is warned about and skipped, never fatal. Watch the build
  log for `SKIPPED`.

## The limitation, stated plainly

**A vector `.pmtiles` you build from your own data will render as a blank map in this app.**

Not a bug you can work around by trying a different tool. `src/map/style.js` hands vector archives
to [`@protomaps/basemaps`](https://github.com/protomaps/basemaps), which emits a complete,
well-tested layer set bound to _Protomaps' schema_ — layers named `earth`, `water`, `roads`,
`landuse`, `places` and so on. Your archive's layer is called `parcels`. Every emitted layer
matches nothing, so nothing draws, and MapLibre reports no error because nothing is wrong: you
asked it to draw layers that happen to be empty.

Three routes that do work:

1. **A feature layer** (`public/feature-layers/`) — the supported way to put your own vector data
   on this map, and the only one that is tappable. Go back to the top of this page.
2. **A raster archive** — render your data to imagery and ship it as PNG or JPEG tiles.
   `buildStyle`'s raster branch draws whatever the archive contains, no schema assumed.
3. **`pmtiles extract` against Protomaps' planet** — for an actual basemap. That is what the
   README documents, it produces a Protomaps-schema archive, and it renders correctly.

Making custom-schema vector archives render would mean a per-region style sidecar declaring
source-layer names and paint — a second styling system alongside the feature-layer one. It was
considered and deliberately not built; at the scale of data this app is for, a feature layer is the
better answer. If a dataset ever genuinely outgrows that, `style.js`'s vector branch carries a note
pointing back here.

## Sources

- [Creating PMTiles — Protomaps docs](https://docs.protomaps.com/pmtiles/create)
- [`pmtiles` CLI reference](https://docs.protomaps.com/pmtiles/cli)
- [go-pmtiles releases (Windows binaries)](https://github.com/protomaps/go-pmtiles/releases)
- [felt/tippecanoe](https://github.com/felt/tippecanoe)
- [QGIS: Write Vector Tiles](https://docs.qgis.org/3.40/en/docs/user_manual/processing_algs/qgis/vectortiles.html)
