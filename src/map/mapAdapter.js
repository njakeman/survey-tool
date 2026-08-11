import { Map as MapLibreMap, addProtocol, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { PMTiles, Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrayBufferSource } from './pmtilesSource.js';
import { buildStyle } from './style.js';
import {
  accuracyRadiusExpression,
  observationsFeatureCollection,
  positionFeature,
} from './overlays.js';
import { initialZoomFromHeader, maxBoundsFromHeader, minZoomFromHeader } from './viewport.js';

// The one module that touches MapLibre. Everything above it (style, overlays,
// follow mode) is pure and node-tested; everything below it (CaptureMap) sees
// only the handle returned here. main.js is the sole importer, loading it
// dynamically so ~800 KB of renderer stays out of the startup path — same
// rule as photo/encode.js.
//
// MapLibre 6 loads its worker from a separate file resolved against
// import.meta.url, which does not survive bundling: production and offline
// would both break with no dev-mode warning. Vite's ?worker&url emits the
// worker as a hashed asset (covered by the precache glob) and setWorkerUrl
// points MapLibre at it.
setWorkerUrl(workerUrl);

// One protocol for the page, but a unique archive key per map.
//
// The scheme has to be exactly `pmtiles`: the library parses tile URLs with a
// hardcoded /pmtiles:\/\//  regex and reads the archive key as url.substr(10),
// so any other scheme makes it treat the key as a remote URL and try to fetch
// it. Uniqueness therefore lives in the key, not the scheme — otherwise two
// regions collide on the shared key and the second silently replaces the
// first underneath a live map.
//
// Protocol exposes no remove, so `destroy` deletes from its `tiles` map
// directly. That reaches past the documented surface, but the alternative is
// pinning every archive ever opened in memory at tens of megabytes each.
const protocol = new Protocol();
let protocolRegistered = false;
let archiveCounter = 0;

function ensureProtocol() {
  if (protocolRegistered) return;
  addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

// How many archives the protocol is holding. Exported so the browser tier can
// prove teardown actually releases them rather than trusting the comment.
export function registeredArchiveCount() {
  return protocol.tiles.size;
}

const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

// Close enough to read field boundaries and gate posts.
const SURVEY_ZOOM = 16;

export async function createMapAdapter({
  container,
  archiveBuffer,
  glyphsUrl,
  tileType = 'vector',
  tileSize,
  attribution,
  onUserPan,
  onError,
}) {
  ensureProtocol();

  archiveCounter += 1;
  const archiveKey = `basemap-${archiveCounter}`;
  const archive = new PMTiles(new ArrayBufferSource(archiveBuffer, archiveKey));
  protocol.add(archive);
  const header = await archive.getHeader();

  const map = new MapLibreMap({
    container,
    style: buildStyle({ glyphsUrl, archiveKey, tileType, tileSize, attribution }),
    center: [header.centerLon, header.centerLat],
    zoom: initialZoomFromHeader(header, SURVEY_ZOOM),
    // A floor only where the archive has one: below its lowest tile zoom
    // there is nothing to draw. maxZoom stays unset so overzoom past the
    // deepest tile still works — blurry beats blank.
    ...(minZoomFromHeader(header) === null ? {} : { minZoom: minZoomFromHeader(header) }),
    // Deliberately no min/maxZoom: those are the archive's *tile* zooms,
    // carried by the vector source itself. Clamping the map to them would
    // stop the surveyor zooming in past the deepest tile, which MapLibre
    // handles fine by overzooming, and a degenerate range (min === max)
    // makes its viewport constraint maths fall over outright.
    //
    // Panning is clamped to what the archive covers — beyond it there are no
    // tiles, and a blank grey void reads as a broken app. null for a
    // world-covering archive, which MapLibre cannot accept (viewport.js).
    maxBounds: maxBoundsFromHeader(header) ?? undefined,
    // A survey map that spins under a gloved hand is worse than useless.
    dragRotate: false,
    pitchWithRotate: false,
    // The map is a panel inside a scrolling one-handed page: one finger
    // scrolls the page, two fingers pan the map.
    cooperativeGestures: true,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });

  map.touchZoomRotate.disableRotation();

  if (onError) map.on('error', (event) => onError(event?.error ?? event));
  // dragstart only fires for user gestures; programmatic easeTo/jumpTo does
  // not, so follow mode can recentre without cancelling itself.
  if (onUserPan) map.on('dragstart', () => onUserPan());

  const ready = new Promise((resolve) => {
    map.on('load', () => {
      map.addSource('position', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addSource('observations', { type: 'geojson', data: EMPTY_COLLECTION });

      map.addLayer({
        id: 'position-accuracy',
        type: 'circle',
        source: 'position',
        paint: {
          'circle-radius': 0,
          'circle-color': '#1d70b8',
          'circle-opacity': 0.15,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#1d70b8',
          'circle-stroke-opacity': 0.4,
        },
      });
      map.addLayer({
        id: 'observations-markers',
        type: 'circle',
        source: 'observations',
        paint: {
          'circle-radius': 7,
          // Pending vs synced has to stay visible everywhere observations
          // are shown (CLAUDE.md), markers included.
          'circle-color': ['case', ['get', 'synced'], '#00703c', '#d4351c'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: 'position-dot',
        type: 'circle',
        source: 'position',
        paint: {
          'circle-radius': 6,
          'circle-color': '#1d70b8',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      container.dataset.mapLoaded = 'true';
      resolve();
    });
  });

  function setPosition(reading) {
    const feature = positionFeature(reading);
    map
      .getSource('position')
      ?.setData(feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY_COLLECTION);
    if (feature) {
      map.setPaintProperty('position-accuracy', 'circle-radius', accuracyRadiusExpression(reading));
    }
  }

  function setObservations(observations) {
    map.getSource('observations')?.setData(observationsFeatureCollection(observations));
  }

  function centreOn(reading) {
    if (!reading) return;
    map.easeTo({ center: [reading.lon, reading.lat], duration: 300 });
  }

  function resize() {
    map.resize();
  }

  function destroy() {
    map.remove();
    // Releases this archive's PMTiles and its buffer; without it, switching
    // regions accumulates them for the life of the page.
    protocol.tiles.delete(archiveKey);
    delete container.dataset.mapLoaded;
  }

  // Read-throughs the CaptureMap never calls; they exist so the browser tier
  // can assert what actually reached the renderer.
  function getMaxBounds() {
    return map.getMaxBounds();
  }

  function isRotationEnabled() {
    return map.dragRotate.isEnabled();
  }

  async function getSourceFeatureCount(sourceId) {
    const source = map.getSource(sourceId);
    if (!source) return 0;
    const data = await source.getData();
    return data?.features?.length ?? 0;
  }

  return {
    container,
    ready,
    setPosition,
    setObservations,
    centreOn,
    resize,
    destroy,
    getMaxBounds,
    isRotationEnabled,
    getSourceFeatureCount,
    getArchiveKey: () => archiveKey,
  };
}
